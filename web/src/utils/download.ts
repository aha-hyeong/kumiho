export const initiateDownload = (url: string) => {
  const token = localStorage.getItem("access_token");
  if (!token) {
    alert("인증 토큰이 없습니다. 다시 로그인해 주세요.");
    return;
  }

  // URL이 이미 쿼리 파라미터를 포함하고 있는지 확인
  const separator = url.includes("?") ? "&" : "?";
  const downloadUrl = `${url}${separator}token=${token}`;

  window.location.href = downloadUrl;
};
