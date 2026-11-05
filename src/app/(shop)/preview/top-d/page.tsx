import { TopPreview, topPreviewMetadata } from "../TopPreview";

const variant = "d";
export const metadata = topPreviewMetadata(variant);

export default function TopPreviewDPage() {
  return <TopPreview variant={variant} />;
}
