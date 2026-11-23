// Two subject names are the same when they differ only in surrounding spaces, full- and half-width
// forms, or letter case. The server refuses such a duplicate; the PWA warns before sending.
export function nameKey(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase()
}
