export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
}

export const products: Product[] = [
  { id: 'keyboard', name: 'Keyboard', price: 89, stock: 12 },
  { id: 'mouse', name: 'Mouse', price: 39, stock: 0 },
];

export const getProduct = (id: string) => products.find((p) => p.id === id);
