import type { ReactNode } from "react";
import { StoreFooter } from "@/components/StoreFooter";
import { StoreHeader } from "@/components/StoreHeader";

export default function ShopLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="site-shell">
      <StoreHeader />
      {children}
      <StoreFooter />
    </div>
  );
}
