import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SettingsLayout } from '@/components/ui/screen-layouts';
import { PageHeading } from '@/components/ui/typography';
import { Card, CardContent } from '@/components/ui/card';
import manual from './manual.json';
import { HelpVideos } from '@/components/help/HelpVideos';

export default function HelpPage() {
  return <SettingsLayout>
    <PageHeading>TaskSlowth 操作説明</PageHeading>
    <p>操作動画と手順をまとめています。右上の本のアイコンからいつでも開けます。</p>
    <HelpVideos />
    <Card><CardContent>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        h2: props => <h2 className="mt-8 mb-3 text-lg font-semibold" {...props} />,
        h3: props => <h3 className="mt-4 mb-2 font-medium" {...props} />,
        p: props => <p className="mb-3 text-sm leading-relaxed" {...props} />,
        ol: props => <ol className="mb-4 list-decimal space-y-2 pl-5 text-sm" {...props} />,
        table: props => <div className="mb-4 overflow-x-auto"><table className="w-full text-left text-sm" {...props} /></div>,
        th: props => <th className="border p-2 font-medium" {...props} />,
        td: props => <td className="border p-2" {...props} />,
      }}>{manual.text}</ReactMarkdown>
    </CardContent></Card>
  </SettingsLayout>;
}
