'use client';

import Link from 'next/link';
import { SettingsLayout } from '@/components/ui/screen-layouts';
import { PageHeading } from '@/components/ui/typography';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AISettingsForm } from '@/components/ai/AISettingsForm';

export default function AISettingsPage() {
  return (
    <SettingsLayout>
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="icon">
          <Link href="/settings" aria-label="設定に戻る" title="設定に戻る">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <PageHeading>AI設定</PageHeading>
          <p className="text-muted-foreground">
            AIアシスタントの設定を管理します
          </p>
        </div>
      </div>

      <AISettingsForm />
    </SettingsLayout>
  );
}
