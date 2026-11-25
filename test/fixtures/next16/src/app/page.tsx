import { ProductCard } from '@/components/product/ProductCard';
import { products } from '@/lib/products';

export default function HomePage() {
  return (
    <>
      <h1>Home</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </>
  );
}
