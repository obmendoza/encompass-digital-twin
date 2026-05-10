"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function actionSetBpoToken(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) {
    redirect("/bpo/login?error=missing");
  }
  const c = await cookies();
  c.set("bpo_token", token, {
    path: "/bpo",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8, // 8 hours
  });
  redirect("/bpo/queue");
}

export async function actionClearBpoToken(): Promise<void> {
  const c = await cookies();
  c.delete("bpo_token");
  redirect("/bpo/login");
}
