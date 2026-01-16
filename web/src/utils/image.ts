export const getAuthenticatedImageUrl = (url: string) => {
  const token = localStorage.getItem("access_token");
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${token}`;
};
