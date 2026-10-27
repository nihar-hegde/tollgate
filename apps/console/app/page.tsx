import { redirect } from "next/navigation";

// The overview arrives on Day 8; until then the decision log is home.
export default function Home() {
  redirect("/decisions");
}
