import type { ComponentPropsWithoutRef } from 'react';

export function OrderMenu({ text, children, ...props }: ComponentPropsWithoutRef<'select'> & { text: string }) {
  return <span className="ow-text-menu" title={text}>
    <span aria-hidden="true">{text}</span>
    <select {...props}>{children}</select>
  </span>;
}
