import { useEffect, useState } from 'react';
import api from '../api/client';

interface Props {
  /** Адрес файла в API (относительно базового URL), отдаётся только с авторизацией */
  url: string;
  alt: string;
  className?: string;
}

/**
 * Картинка, защищённая правами доступа. Обычный <img src> не передаёт токен,
 * поэтому файл загружается через API и показывается из памяти браузера.
 */
export default function AuthImage({ url, alt, className }: Props) {
  const [loaded, setLoaded] = useState<{ url: string; src: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    api.get(url, { responseType: 'blob' })
      .then(res => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setLoaded({ url, src: objectUrl });
      })
      .catch(() => { /* нет доступа или файл удалён — картинку просто не показываем */ });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (!loaded || loaded.url !== url) return null;
  return <img src={loaded.src} alt={alt} className={className} />;
}
