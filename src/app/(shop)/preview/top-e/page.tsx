import { TopPreview, topPreviewMetadata } from "../TopPreview";

const variant = "e";
export const metadata = topPreviewMetadata(variant);

export default function TopPreviewEPage() {
  return <TopPreview variant={variant} />;
}
