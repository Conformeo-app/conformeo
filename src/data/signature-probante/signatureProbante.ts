import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getSecureValue, setSecureValue } from '../../core/security/secureStore';
import { audit } from '../audit-compliance';
import { documents } from '../documents';
import { media } from '../media';
import { offlineDB } from '../offline/outbox';
import { geo } from '../geo-context';
import { SignatureActor, SignatureCanvasData, SignatureRecord, SignatureStatus, VerifyResult } from './types';

const DB_NAME = 'conformeo.db';
const TABLE_NAME = 'signatures';

// Shared with sessions audit (same SecureStore key).
const DEVICE_ID_KEY = 'conformeo.security.device_id';

type SignatureRow = {
  id: string;
  org_id: string;
  document_id: string;
  version_id: string;
  signed_document_version_id: string | null;

  signer_user_id: string;
  signer_role: string;
  signer_display_name: string | null;
  device_id: string | null;

  signature_asset_id: string | null;
  signed_pdf_asset_id: string | null;

  file_hash: string | null;
  source_version_hash: string | null;

  signed_at_local: string | null;
  signed_at_server: string | null;

  geo_lat: number | null;
  geo_lng: number | null;

  status: SignatureStatus;
  canvas_json: string;

  created_at: string;
  updated_at: string;
  last_error: string | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let setupPromise: Promise<void> | null = null;

let actor: SignatureActor | null = null;
let activeDraftId: string | null = null;

function nowIso() {
  return new Date().toISOString();
}

function createUuid() {
  const randomUUID = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function toOptional(value: string | null | undefined) {
  return value && value.length > 0 ? value : undefined;
}

function parseJsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function ensureCanvasData(value: unknown): SignatureCanvasData {
  const fallback: SignatureCanvasData = { strokes: [] };
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const candidate = value as Partial<SignatureCanvasData>;
  if (!Array.isArray(candidate.strokes)) {
    return fallback;
  }

  return {
    strokes: candidate.strokes
      .filter((stroke) => Array.isArray(stroke))
      .map((stroke) =>
        (stroke as any[])
          .map((point) => {
            if (!point || typeof point !== 'object') {
              return null;
            }

            const p = point as { x?: unknown; y?: unknown };
            const x = typeof p.x === 'number' ? p.x : null;
            const y = typeof p.y === 'number' ? p.y : null;

            if (x === null || y === null) {
              return null;
            }

            return {
              x: Math.max(0, Math.min(1, x)),
              y: Math.max(0, Math.min(1, y))
            };
          })
          .filter(Boolean) as { x: number; y: number }[]
      )
  };
}

function toErrorMessage(error: unknown, fallback = 'Erreur signature') {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }

  return dbPromise;
}

async function setupSchema() {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id TEXT PRIMARY KEY NOT NULL,
      org_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      signed_document_version_id TEXT,

      signer_user_id TEXT NOT NULL,
      signer_role TEXT NOT NULL,
      signer_display_name TEXT,
      device_id TEXT,

      signature_asset_id TEXT,
      signed_pdf_asset_id TEXT,

      file_hash TEXT,
      source_version_hash TEXT,

      signed_at_local TEXT,
      signed_at_server TEXT,

      geo_lat REAL,
      geo_lng REAL,

      status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PENDING', 'FINAL')),
      canvas_json TEXT NOT NULL,

      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_signatures_document_created
      ON ${TABLE_NAME}(document_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_signatures_org_created
      ON ${TABLE_NAME}(org_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_signatures_status
      ON ${TABLE_NAME}(status, created_at DESC);
  `);
}

async function ensureSetup() {
  if (!setupPromise) {
    setupPromise = setupSchema();
  }

  return setupPromise;
}

function requireDocumentDirectory() {
  const directory = FileSystem.documentDirectory;
  if (!directory) {
    throw new Error('FileSystem documentDirectory indisponible.');
  }
  return directory;
}

function signatureRootDir() {
  return `${requireDocumentDirectory()}signature_probante/`;
}

function signatureTmpDir() {
  return `${signatureRootDir()}tmp/`;
}

async function ensureDirectories() {
  await FileSystem.makeDirectoryAsync(signatureRootDir(), { intermediates: true });
  await FileSystem.makeDirectoryAsync(signatureTmpDir(), { intermediates: true });
}

function mapRow(row: SignatureRow): SignatureRecord {
  const canvas = ensureCanvasData(parseJsonObject(row.canvas_json));

  return {
    id: row.id,
    org_id: row.org_id,
    document_id: row.document_id,
    version_id: row.version_id,
    signed_document_version_id: row.signed_document_version_id ?? undefined,
    signer_user_id: row.signer_user_id,
    signer_role: row.signer_role,
    signer_display_name: row.signer_display_name ?? undefined,
    device_id: row.device_id ?? undefined,
    signature_asset_id: row.signature_asset_id ?? '',
    signed_pdf_asset_id: row.signed_pdf_asset_id ?? '',
    file_hash: row.file_hash ?? '',
    source_version_hash: row.source_version_hash ?? undefined,
    signed_at_local: row.signed_at_local ?? row.created_at,
    signed_at_server: row.signed_at_server ?? undefined,
    geo_lat: typeof row.geo_lat === 'number' ? row.geo_lat : undefined,
    geo_lng: typeof row.geo_lng === 'number' ? row.geo_lng : undefined,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_error: row.last_error ?? undefined,
    canvas
  };
}

async function getRowById(id: string): Promise<SignatureRow | null> {
  await ensureSetup();
  const db = await getDb();

  const row = await db.getFirstAsync<SignatureRow>(
    `
      SELECT *
      FROM ${TABLE_NAME}
      WHERE id = ?
      LIMIT 1
    `,
    id
  );

  return row ?? null;
}

async function upsertRow(row: SignatureRow) {
  await ensureSetup();
  const db = await getDb();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO ${TABLE_NAME}
      (
        id, org_id, document_id, version_id, signed_document_version_id,
        signer_user_id, signer_role, signer_display_name, device_id,
        signature_asset_id, signed_pdf_asset_id,
        file_hash, source_version_hash,
        signed_at_local, signed_at_server,
        geo_lat, geo_lng,
        status, canvas_json,
        created_at, updated_at,
        last_error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    row.id,
    row.org_id,
    row.document_id,
    row.version_id,
    row.signed_document_version_id,
    row.signer_user_id,
    row.signer_role,
    row.signer_display_name,
    row.device_id,
    row.signature_asset_id,
    row.signed_pdf_asset_id,
    row.file_hash,
    row.source_version_hash,
    row.signed_at_local,
    row.signed_at_server,
    row.geo_lat,
    row.geo_lng,
    row.status,
    row.canvas_json,
    row.created_at,
    row.updated_at,
    row.last_error
  );
}

function requireActor(): SignatureActor {
  if (!actor || normalizeText(actor.user_id).length == 0) {
    throw new Error('Acteur signature manquant (user_id).');
  }

  return {
    user_id: normalizeText(actor.user_id),
    role: actor.role ?? null,
    display_name: actor.display_name ?? null
  };
}

function randomToken(prefix: string) {
  const randomUUID = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return `${prefix}-${randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function getOrCreateDeviceId() {
  const existing = await getSecureValue(DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }

  const generated = randomToken('device');
  await setSecureValue(DEVICE_ID_KEY, generated);
  return generated;
}

function drawSignatureOnPage(
  page: any,
  canvas: SignatureCanvasData,
  box: { x: number; y: number; w: number; h: number }
) {
  const strokes = canvas.strokes ?? [];

  for (const stroke of strokes) {
    for (let i = 1; i < stroke.length; i += 1) {
      const prev = stroke[i - 1];
      const next = stroke[i];

      const x1 = box.x + prev.x * box.w;
      const y1 = box.y + (1 - prev.y) * box.h;
      const x2 = box.x + next.x * box.w;
      const y2 = box.y + (1 - next.y) * box.h;

      page.drawLine({
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        thickness: 1.5,
        color: rgb(0.05, 0.05, 0.05)
      });
    }
  }
}

async function generateSignedPdfBase64(input: {
  sourcePdfBase64: string;
  signatureId: string;
  documentTitle: string;
  orgId: string;
  signerLabel: string;
  signerRole: string;
  signedAtLocal: string;
  sourceVersionHash: string;
  canvas: SignatureCanvasData;
}) {
  const pdfDoc = await PDFDocument.load(input.sourcePdfBase64, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  if (firstPage) {
    firstPage.drawText('SIGNE', {
      x: 18,
      y: 18,
      size: 10,
      font,
      color: rgb(0.06, 0.4, 0.32)
    });
  }

  const page = pdfDoc.addPage();
  const size = page.getSize();

  const titleY = size.height - 48;
  page.drawText('Signature probante', {
    x: 48,
    y: titleY,
    size: 18,
    font,
    color: rgb(0.05, 0.1, 0.1)
  });

  const metaLines = [
    `Document: ${input.documentTitle}`,
    `Organisation: ${input.orgId}`,
    `Signature ID: ${input.signatureId}`,
    `Signataire: ${input.signerLabel} (${input.signerRole})`,
    `Date (local): ${new Date(input.signedAtLocal).toLocaleString('fr-FR')}`,
    `Hash source: ${input.sourceVersionHash}`
  ];

  let y = titleY - 28;
  for (const line of metaLines) {
    page.drawText(line, { x: 48, y, size: 10, font, color: rgb(0.25, 0.3, 0.32) });
    y -= 14;
  }

  const box = { x: 48, y: 96, w: size.width - 96, h: 160 };
  page.drawRectangle({
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    borderWidth: 1,
    borderColor: rgb(0.82, 0.86, 0.9)
  });
  drawSignatureOnPage(page, input.canvas, box);

  page.drawText(`Genere par Conformeo - ${input.signatureId}`, {
    x: 48,
    y: 62,
    size: 9,
    font,
    color: rgb(0.5, 0.56, 0.6)
  });

  return pdfDoc.saveAsBase64({ dataUri: false });
}

async function generateSignatureReceiptBase64(input: {
  signatureId: string;
  documentTitle: string;
  orgId: string;
  signerLabel: string;
  signerRole: string;
  signedAtLocal: string;
  sourceVersionHash: string;
  canvas: SignatureCanvasData;
}) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const page = pdfDoc.addPage([595.28, 841.89]);
  const size = page.getSize();

  const titleY = size.height - 54;
  page.drawText('Recap signature', {
    x: 48,
    y: titleY,
    size: 18,
    font,
    color: rgb(0.05, 0.1, 0.1)
  });

  const metaLines = [
    `Document: ${input.documentTitle}`,
    `Organisation: ${input.orgId}`,
    `Signature ID: ${input.signatureId}`,
    `Signataire: ${input.signerLabel} (${input.signerRole})`,
    `Date (local): ${new Date(input.signedAtLocal).toLocaleString('fr-FR')}`,
    `Hash source: ${input.sourceVersionHash}`
  ];

  let y = titleY - 28;
  for (const line of metaLines) {
    page.drawText(line, { x: 48, y, size: 10, font, color: rgb(0.25, 0.3, 0.32) });
    y -= 14;
  }

  const box = { x: 48, y: 120, w: size.width - 96, h: 200 };
  page.drawRectangle({
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    borderWidth: 1,
    borderColor: rgb(0.82, 0.86, 0.9)
  });
  drawSignatureOnPage(page, input.canvas, box);

  page.drawText(`Genere par Conformeo - ${input.signatureId}`, {
    x: 48,
    y: 86,
    size: 9,
    font,
    color: rgb(0.5, 0.56, 0.6)
  });

  return pdfDoc.saveAsBase64({ dataUri: false });
}

async function writeTmpPdf(base64: string, fileName: string) {
  await ensureDirectories();

  const target = `${signatureTmpDir()}${fileName}`;
  await FileSystem.writeAsStringAsync(target, base64, {
    encoding: FileSystem.EncodingType.Base64
  });

  const info = await FileSystem.getInfoAsync(target);
  if (!info.exists) {
    throw new Error('Ecriture PDF impossible (tmp).');
  }

  return {
    uri: target,
    sizeBytes: typeof info.size === 'number' ? info.size : 0
  };
}

async function loadPdfBase64(uri: string) {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64
  });
}

async function sha256FromBase64(base64: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64);
}

export const sign = {
  setActor(next: SignatureActor | null) {
    actor = next;
  },

  cancel() {
    activeDraftId = null;
  },

  async start(documentId: string, versionId: string) {
    await ensureSetup();

    const actorContext = requireActor();

    const docId = normalizeText(documentId);
    const verId = normalizeText(versionId);

    if (!docId) {
      throw new Error('documentId manquant.');
    }

    if (!verId) {
      throw new Error('versionId manquant.');
    }

    const doc = await documents.getById(docId);
    if (!doc) {
      throw new Error('Document introuvable.');
    }

    const versions = await documents.listVersions(docId);
    const version = versions.find((candidate) => candidate.id === verId);
    if (!version) {
      throw new Error('Version introuvable pour ce document.');
    }

    if (version.file_mime !== 'application/pdf') {
      throw new Error('Signature probante supportee uniquement sur PDF pour le MVP.');
    }

    const createdAt = nowIso();
    const deviceId = await getOrCreateDeviceId();

    const row: SignatureRow = {
      id: createUuid(),
      org_id: doc.org_id,
      document_id: docId,
      version_id: verId,
      signed_document_version_id: null,
      signer_user_id: actorContext.user_id,
      signer_role: normalizeText(actorContext.role ?? 'FIELD') || 'FIELD',
      signer_display_name: toOptional(actorContext.display_name) ?? null,
      device_id: deviceId,
      signature_asset_id: null,
      signed_pdf_asset_id: null,
      file_hash: null,
      source_version_hash: version.file_hash,
      signed_at_local: null,
      signed_at_server: null,
      geo_lat: null,
      geo_lng: null,
      status: 'DRAFT',
      canvas_json: JSON.stringify({ strokes: [] } satisfies SignatureCanvasData),
      created_at: createdAt,
      updated_at: createdAt,
      last_error: null
    };

    await upsertRow(row);
    activeDraftId = row.id;
    return mapRow(row);
  },

  async capture(canvas: SignatureCanvasData) {
    const draftId = normalizeText(activeDraftId);
    if (!draftId) {
      throw new Error('Aucune signature en cours.');
    }

    const row = await getRowById(draftId);
    if (!row) {
      throw new Error('Signature draft introuvable.');
    }

    const data = ensureCanvasData(canvas);
    if (data.strokes.length == 0) {
      throw new Error('Signature vide.');
    }

    const next: SignatureRow = {
      ...row,
      canvas_json: JSON.stringify(data),
      updated_at: nowIso(),
      last_error: null
    };

    await upsertRow(next);
    return mapRow(next);
  },

  async finalize(): Promise<SignatureRecord> {
    const draftId = normalizeText(activeDraftId);
    if (!draftId) {
      throw new Error('Aucune signature en cours.');
    }

    const row = await getRowById(draftId);
    if (!row) {
      throw new Error('Signature draft introuvable.');
    }

    const actorContext = requireActor();

    const doc = await documents.getById(row.document_id);
    if (!doc) {
      throw new Error('Document introuvable.');
    }

    const versions = await documents.listVersions(row.document_id);
    const sourceVersion = versions.find((candidate) => candidate.id === row.version_id);
    if (!sourceVersion) {
      throw new Error('Version source introuvable.');
    }

    if (sourceVersion.file_mime != 'application/pdf') {
      throw new Error('Signature probante supportee uniquement sur PDF pour le MVP.');
    }

    const canvas = ensureCanvasData(parseJsonObject(row.canvas_json));
    if (canvas.strokes.length == 0) {
      throw new Error('Signature vide.');
    }

    const sourceAsset = await media.getById(sourceVersion.file_asset_id);
    if (!sourceAsset) {
      throw new Error('Fichier PDF local introuvable pour cette version.');
    }

    const sourceBase64 = await loadPdfBase64(sourceAsset.local_path);

    const signedAtLocal = nowIso();
    const signerLabel = toOptional(actorContext.display_name) ?? actorContext.user_id;
    const signerRole = normalizeText(actorContext.role ?? row.signer_role) || 'FIELD';

    const sourceHash = sourceVersion.file_hash;

    const signedPdfBase64 = await generateSignedPdfBase64({
      sourcePdfBase64: sourceBase64,
      signatureId: row.id,
      documentTitle: doc.title,
      orgId: doc.org_id,
      signerLabel,
      signerRole,
      signedAtLocal,
      sourceVersionHash: sourceHash,
      canvas
    });

    const receiptBase64 = await generateSignatureReceiptBase64({
      signatureId: row.id,
      documentTitle: doc.title,
      orgId: doc.org_id,
      signerLabel,
      signerRole,
      signedAtLocal,
      sourceVersionHash: sourceHash,
      canvas
    });

    const signedHash = await sha256FromBase64(signedPdfBase64);

    try {
      const signedTmp = await writeTmpPdf(signedPdfBase64, `signed_${row.id}.pdf`);
      const receiptTmp = await writeTmpPdf(receiptBase64, `signature_${row.id}.pdf`);

      const signedAsset = await media.registerGeneratedFile(
        {
          org_id: doc.org_id,
          project_id: doc.project_id,
          tag: 'signed_pdf'
        },
        {
          uri: signedTmp.uri,
          mimeType: 'application/pdf',
          fileName: `signed_${row.id}.pdf`,
          fileSize: signedTmp.sizeBytes
        }
      );

      const receiptAsset = await media.registerGeneratedFile(
        {
          org_id: doc.org_id,
          project_id: doc.project_id,
          tag: 'signature_receipt'
        },
        {
          uri: receiptTmp.uri,
          mimeType: 'application/pdf',
          fileName: `signature_${row.id}.pdf`,
          fileSize: receiptTmp.sizeBytes
        }
      );

      await Promise.all([
        FileSystem.deleteAsync(signedTmp.uri, { idempotent: true }),
        FileSystem.deleteAsync(receiptTmp.uri, { idempotent: true })
      ]);

      await media.process(signedAsset.id);
      await media.enqueueUpload(signedAsset.id);

      await media.process(receiptAsset.id);
      await media.enqueueUpload(receiptAsset.id);

      const signedVersion = await documents.addVersion(doc.id, {
        source: 'existing',
        existing_asset_id: signedAsset.id,
        tag: 'signed_pdf'
      });

      await documents.update(doc.id, {
        status: 'SIGNED'
      });

      const updatedAt = nowIso();
      const next: SignatureRow = {
        ...row,
        signed_document_version_id: signedVersion.id,
        signature_asset_id: receiptAsset.id,
        signed_pdf_asset_id: signedAsset.id,
        file_hash: signedHash,
        source_version_hash: sourceHash,
        signed_at_local: signedAtLocal,
        status: 'PENDING',
        updated_at: updatedAt,
        last_error: null
      };

      await upsertRow(next);

      const record = mapRow(next);

      await offlineDB.enqueueOperation({
        id: record.id,
        entity: 'signatures',
        entity_id: record.id,
        type: 'CREATE',
        payload: {
          ...record,
          orgId: record.org_id,
          org_id: record.org_id,
          project_id: doc.project_id,
          user_id: record.signer_user_id
        }
      });

      await audit.log('signature.finalize', 'SIGNATURE', record.id, {
        document_id: doc.id,
        version_id: sourceVersion.id,
        signed_document_version_id: record.signed_document_version_id,
        signed_pdf_asset_id: record.signed_pdf_asset_id,
        signature_asset_id: record.signature_asset_id,
        status: record.status,
        file_hash: record.file_hash,
        signed_at_local: record.signed_at_local
      });

      void geo.capture({
        entity: 'SIGNATURE',
        entity_id: record.id,
        org_id: record.org_id,
        user_id: record.signer_user_id,
        project_id: doc.project_id
      });

      activeDraftId = null;
      return record;
    } catch (error) {
      const message = toErrorMessage(error, 'Finalisation signature impossible.');
      await upsertRow({
        ...row,
        last_error: message,
        updated_at: nowIso()
      });
      throw new Error(message);
    }
  },

  async getByDocument(documentId: string) {
    const docId = normalizeText(documentId);
    if (!docId) {
      return [] as SignatureRecord[];
    }

    await ensureSetup();
    const db = await getDb();

    const rows = await db.getAllAsync<SignatureRow>(
      `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE document_id = ?
          AND status != 'DRAFT'
        ORDER BY created_at DESC
      `,
      docId
    );

    return rows.map(mapRow);
  },

  async markFinal(signatureId: string, serverTimestamp?: string) {
    const id = normalizeText(signatureId);
    if (!id) {
      return;
    }

    const row = await getRowById(id);
    if (!row) {
      return;
    }

    if (row.status === 'FINAL') {
      return;
    }

    const updatedAt = nowIso();
    const next: SignatureRow = {
      ...row,
      status: 'FINAL',
      signed_at_server: serverTimestamp ?? updatedAt,
      updated_at: updatedAt,
      last_error: null
    };

    await upsertRow(next);

    await audit.log('signature.mark_final', 'SIGNATURE', next.id, {
      signed_at_server: next.signed_at_server,
      signed_at_local: next.signed_at_local,
      file_hash: next.file_hash
    });
  },

  async verify(signatureId: string): Promise<VerifyResult> {
    const id = normalizeText(signatureId);
    if (!id) {
      return { valid: false, reason: 'signatureId manquant' };
    }

    const row = await getRowById(id);
    if (!row) {
      return { valid: false, reason: 'Signature introuvable' };
    }

    if (row.status === 'DRAFT') {
      return { valid: false, reason: 'Signature non finalisee' };
    }

    if (!row.signed_pdf_asset_id || !row.file_hash) {
      return { valid: false, reason: 'Signature incomplete (PDF/hash manquant)' };
    }

    const asset = await media.getById(row.signed_pdf_asset_id);
    if (!asset) {
      return { valid: false, reason: 'PDF signe introuvable localement' };
    }

    try {
      const base64 = await loadPdfBase64(asset.local_path);
      const hash = await sha256FromBase64(base64);

      if (hash !== row.file_hash) {
        return { valid: false, reason: 'Hash mismatch (PDF modifie ou corrompu)' };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, reason: toErrorMessage(error, 'Verification impossible') };
    }
  }
};
