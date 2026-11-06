import { useEffect, useState } from "react";
import { getAttachment, type Attachment } from "../model";
export function AttachmentImage({
  attachment,
  className,
}: {
  attachment: Attachment;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setUrl("");
    void getAttachment(attachment.id)
      .then((blob) => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id]);
  return url ? (
    <img className={className} src={url} alt={attachment.name} />
  ) : (
    <span className={`${className || ""} image-unavailable`}>
      图片未在本机找到
    </span>
  );
}
