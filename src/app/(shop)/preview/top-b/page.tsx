import { TopPreview, topPreviewMetadata } from "../TopPreview";

const variant = "b";
export const metadata = topPreviewMetadata(variant);

export default function TopPreviewBPage() {
  return <TopPreview variant={variant} />;
}
