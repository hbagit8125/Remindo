import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { addCategory, categoryInputSchema, deleteCategory, getCategories, setHidden, updateCategory } from "@/lib/categories";

const err = (e: unknown) => NextResponse.json({ error: (e as Error).message }, { status: 400 });

export async function GET() {
  await connection();
  return NextResponse.json(await getCategories());
}

/** Add your own category: { name, emoji, type }. */
export async function POST(req: Request) {
  const p = categoryInputSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Give the category a name" }, { status: 400 });
  try {
    return NextResponse.json({ category: await addCategory(p.data), ...(await getCategories()) });
  } catch (e) {
    return err(e);
  }
}

/** Rename / change emoji: { from, name?, emoji? }  ·  hide/show a built-in: { name, hidden }. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const hide = z.object({ name: z.string().min(1), hidden: z.boolean() }).safeParse(body);
  const ren = z.object({ from: z.string().min(1), name: z.string().optional(), emoji: z.string().max(8).optional() }).safeParse(body);
  try {
    if (hide.success) await setHidden(hide.data.name, hide.data.hidden);
    else if (ren.success) await updateCategory(ren.data.from, ren.data);
    else return NextResponse.json({ error: "Bad input" }, { status: 400 });
    return NextResponse.json(await getCategories());
  } catch (e) {
    return err(e);
  }
}

/** Delete your own category: ?name=… (its entries move to Other). */
export async function DELETE(req: Request) {
  const n = new URL(req.url).searchParams.get("name");
  if (!n) return NextResponse.json({ error: "Which category?" }, { status: 400 });
  try {
    await deleteCategory(n);
    return NextResponse.json(await getCategories());
  } catch (e) {
    return err(e);
  }
}
