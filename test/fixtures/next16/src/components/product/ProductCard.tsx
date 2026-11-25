import Link from 'next/link';
import { Badge, Button, Card } from '@/components/ui';
import { formatPrice } from '@/lib/format';
import type { Product } from '@/lib/products';

export function ProductCard({ product }: { product: Product }) {
  return (
    <Card title={product.name}>
      <p>
        {formatPrice(product.price)} {product.stock > 0 && <Badge tone="success">In stock</Badge>}
      </p>
      <Link href={`/products/${product.id}`}>Details</Link> <Button size="sm">Add to cart</Button>
    </Card>
  );
}
