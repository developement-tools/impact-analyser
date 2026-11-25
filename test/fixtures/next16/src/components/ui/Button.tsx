'use client';

import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
};

export function Button({ variant = 'default', size = 'md', className, ...props }: Props) {
  const classes = [styles.button, variant !== 'default' && styles[variant], size !== 'md' && styles[size], className]
    .filter(Boolean)
    .join(' ');
  return <button className={classes} {...props} />;
}
