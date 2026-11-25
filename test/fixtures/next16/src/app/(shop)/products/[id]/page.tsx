import { notFound } from 'next/navigation';
import { Badge, Button, Card } from '@/components/ui';
import { formatPrice } from '@/lib/format';
import { getProduct } from '@/lib/products';

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = getProduct(id);
  if (!product) notFound();
  const available = product.stock > 0;
  return (
    <Card title={product.name}>
      <p>{formatPrice(product.price)}</p>
      <Badge tone={available ? 'success' : 'danger'}>{available ? 'In stock' : 'Sold out'}</Badge>
      <Button variant={available ? 'primary' : 'default'} disabled={!available}>
        Add to cart
      </Button>
    </Card>
  );
}
