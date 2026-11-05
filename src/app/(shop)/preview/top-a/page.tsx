import { TopPreview, topPreviewMetadata } from "../TopPreview";

const variant = "a";
export const metadata = topPreviewMetadata(variant);

export default function TopPreviewAPage() {
  return <TopPreview variant={variant} />;
}
