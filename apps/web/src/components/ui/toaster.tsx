import { useEffect, useState } from "react";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <Sonner
      position={mobile ? "top-center" : "bottom-right"}
      toastOptions={{
        style: {
          background: "var(--navy)",
          color: "var(--canvas)",
          border: "1px solid var(--navy-2)",
          borderRadius: "8px",
        },
      }}
    />
  );
}
