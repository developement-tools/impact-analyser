export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
}

const PRODUCTS: Product[] = [
  { id: '1', name: 'Keyboard', price: 89, stock: 4 },
  { id: '2', name: 'Mouse', price: 39, stock: 0 },
];

export function useProducts() {
  const find = (id: string) => PRODUCTS.find((p) => p.id === id);
  return { products: PRODUCTS, find };
}
