import { useIntersectionObserver } from "@uidotdev/usehooks";

export const useInView = () => {
  const [ref, entry] = useIntersectionObserver({
    threshold: 0,
    root: null,
    rootMargin: "0px",
  });

  return {
    ref,
    inView: entry?.isIntersecting,
  };
};
