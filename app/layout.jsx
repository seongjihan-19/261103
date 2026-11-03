import 'leaflet/dist/leaflet.css';
import './globals.css';

export const metadata = {
  title: '비플페이 지도',
  description: '구획 이름을 입력하면 식당을 지도에 모으고, 비플페이 가능 여부를 함께 표시합니다.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
