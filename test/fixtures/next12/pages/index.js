import Counter from 'components/Counter';
import Button from '../components/Button';

export default function Home() {
  return (
    <main>
      <Counter start={1} />
      <Button variant="danger" size="sm">Reset</Button>
    </main>
  );
}
