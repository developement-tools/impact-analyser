import type { Post } from './types';

const posts: Post[] = [{ slug: 'hello-world', title: 'Hello world', body: 'First post.' }];

export const getPost = (slug: string): Post | undefined => posts.find((p) => p.slug === slug);
