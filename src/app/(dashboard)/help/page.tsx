import { SettingsLayout } from '@/components/ui/screen-layouts';
import { PageHeading } from '@/components/ui/typography';
import { HelpVideos } from '@/components/help/HelpVideos';

export default function HelpPage() {
  return <SettingsLayout>
    <PageHeading>TaskSlowth 操作説明</PageHeading>
    <p>操作動画と手順をまとめています。</p>
    <HelpVideos />
  </SettingsLayout>;
}
