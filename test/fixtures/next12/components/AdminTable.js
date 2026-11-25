import { formatDate } from 'lib/format';

export default function AdminTable() {
  return <table><tbody><tr><td>{formatDate(new Date())}</td></tr></tbody></table>;
}
