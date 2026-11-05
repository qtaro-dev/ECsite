import { TopPreview, topPreviewMetadata } from "../TopPreview";

const variant = "c";
export const metadata = topPreviewMetadata(variant);

export default function TopPreviewCPage() {
  return <TopPreview variant={variant} />;
}
