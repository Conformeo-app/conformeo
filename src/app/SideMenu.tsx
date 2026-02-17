import type { DrawerContentComponentProps } from '@react-navigation/drawer';
import React from 'react';
import { ShellDrawerContent } from '../navigation/ShellDrawerContent';

export function SideMenu(props: DrawerContentComponentProps) {
  return <ShellDrawerContent {...props} />;
}

