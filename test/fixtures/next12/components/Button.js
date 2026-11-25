export default function Button({ variant = 'default', size = 'md', ...props }) {
  return <button className={`btn btn-${variant} btn-${size}`} {...props} />;
}
