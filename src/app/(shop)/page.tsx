import { HomeWithArtwork, selectedHomeArtwork } from "./HomeWithArtwork";

export default function HomePage() {
  return <HomeWithArtwork variant={selectedHomeArtwork} showCardImages />;
}
