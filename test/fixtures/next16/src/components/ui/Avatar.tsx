export function Avatar({ name }: { name: string }) {
  return <span title={name}>{name.slice(0, 1).toUpperCase()}</span>;
}
