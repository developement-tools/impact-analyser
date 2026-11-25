import Button from 'components/Button';

function Error({ statusCode }) {
  return (
    <p>
      {statusCode} <Button variant="primary">Home</Button>
    </p>
  );
}

export default Error;
