import { notFound } from 'next/navigation';
import { getPost } from '@/lib/posts';
import type { Post } from '@/lib/types';

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post: Post | undefined = getPost(slug);
  if (!post) notFound();
  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.body}</p>
    </article>
  );
}
