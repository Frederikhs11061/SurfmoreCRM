import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function POST(req) {
  const { email, password, name } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: 'Email og adgangskode er påkrævet' }, { status: 400 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name || '' },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ user: data.user });
}
