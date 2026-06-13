import React from "react";

export function useTicker() {
  const [now, setNow] = React.useState(new Date());

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}
