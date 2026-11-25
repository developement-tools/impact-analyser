import { NextResponse } from 'next/server';

export function middleware(req) {
  return req.cookies.admin ? NextResponse.next() : NextResponse.redirect('/');
}
