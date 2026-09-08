/** All money moves as integer paise (spec §14); formatting happens only at render. */
const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const inrExact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

export function formatPaise(paise: number): string {
  return paise % 100 === 0 ? inr.format(paise / 100) : inrExact.format(paise / 100);
}
