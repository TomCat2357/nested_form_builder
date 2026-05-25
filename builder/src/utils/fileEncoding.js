const bytesToBase64 = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

export const blobToBase64 = async (blob) => {
  const arrayBuffer = await blob.arrayBuffer();
  return bytesToBase64(new Uint8Array(arrayBuffer));
};

export const fileToBase64 = blobToBase64;
