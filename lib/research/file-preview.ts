export function filePreviewKind(name: string) {
  const filename = name.toLowerCase();
  if (filename.endsWith('.pdf')) return 'pdf';
  if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) return 'excel';
  return null;
}
