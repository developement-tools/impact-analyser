export function Card({ title, tone = 'neutral' }: { title: string; tone?: 'neutral' | 'success' }) {
  return <section className={`card card-${tone}`}>{title}</section>;
}
