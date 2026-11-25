import { Button, Card } from '@/components/ui';

export default function CheckoutPage() {
  return (
    <Card title="Checkout">
      <p>Your cart is ready.</p>
      <Button variant="primary" size="lg">
        Pay now
      </Button>
    </Card>
  );
}
