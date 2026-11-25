export function useCart() {
  const count = useState('cart-count', () => 0);
  return { count };
}
