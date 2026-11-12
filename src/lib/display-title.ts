export function breadcrumbTitle(title: string) {
  const characters = Array.from(title);
  return characters.length > 60 ? `${characters.slice(0, 60).join("")}...` : title;
}
