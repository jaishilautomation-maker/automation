import { redirect } from "next/navigation";

// The chemist review now lives under Lab QC. Old links and bookmarks land there.
export default function ChemistReviewRedirect() {
  redirect("/lab-qc/phase-a-review");
}
