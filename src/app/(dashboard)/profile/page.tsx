'use client';
import { SettingsLayout } from '@/components/ui/screen-layouts';
import { PageHeading } from '@/components/ui/typography';

import { useState, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Camera, Save, X, Loader2 } from 'lucide-react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getFirebaseDb } from '@/lib/firebase/config';
import { getFirebaseStorage } from '@/lib/firebase/config';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { ImageCropperDialog } from '@/components/common/ImageCropperDialog';
import { readFileAsDataURL } from '@/lib/utils/image';
import { AISupportSettings } from '@/components/ai/AISupportSettings';

export default function ProfilePage() {
  const { user } = useAuthStore();
  const { firebaseUser } = useAuth();

  const [isEditingName, setIsEditingName] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [cropperOpen, setCropperOpen] = useState(false);
  const [selectedImageSrc, setSelectedImageSrc] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleSaveName = async () => {
    if (!user || !displayName.trim()) return;

    setIsSaving(true);
    try {
      const db = getFirebaseDb();
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, {
        displayName: displayName.trim(),
        updatedAt: serverTimestamp(),
      });

      // Update local state
      useAuthStore.getState().setUser({
        ...user,
        displayName: displayName.trim(),
      });

      setIsEditingName(false);
    } catch (error) {
      console.error('Failed to update display name:', error);
      alert('表示名の更新に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setDisplayName(user?.displayName || '');
    setIsEditingName(false);
  };

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('画像ファイルを選択してください');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('ファイルサイズは5MB以下にしてください');
      return;
    }

    // Read file and open cropper
    const imageSrc = await readFileAsDataURL(file);
    setSelectedImageSrc(imageSrc);
    setCropperOpen(true);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    if (!user) return;

    setIsUploadingPhoto(true);
    try {
      const storage = getFirebaseStorage();
      const photoRef = ref(storage, `users/${user.id}/profile.jpg`);

      await uploadBytes(photoRef, croppedBlob);
      const photoURL = await getDownloadURL(photoRef);

      // Update Firestore
      const db = getFirebaseDb();
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, {
        photoURL,
        updatedAt: serverTimestamp(),
      });

      // Update local state
      useAuthStore.getState().setUser({
        ...user,
        photoURL,
      });
    } catch (error) {
      console.error('Failed to upload photo:', error);
      alert('写真のアップロードに失敗しました');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <SettingsLayout>
      <div>
        <PageHeading>マイアカウント</PageHeading>
        <p className="text-muted-foreground">プロフィール情報を管理します</p>
      </div>

      <AISupportSettings key={user.id} userId={user.id} />

      {/* Profile identity */}
      <Card density="compact" aria-label="基本プロフィール">
        <CardHeader>
          <CardTitle>プロフィール</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative">
              <Avatar className="h-24 w-24">
                <AvatarImage src={user.photoURL || ''} alt={user.displayName} />
                <AvatarFallback className="text-2xl">
                  {getInitials(user.displayName)}
                </AvatarFallback>
              </Avatar>
              {isUploadingPhoto && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                  <Loader2 className="h-6 w-6 animate-spin text-white" />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Button
                variant="outline"
                onClick={handlePhotoClick}
                disabled={isUploadingPhoto}
              >
                <Camera className="mr-2 h-4 w-4" />
                画像を変更
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="hidden"
              />
              <p className="text-xs text-muted-foreground">
                JPG, PNG, GIF (最大5MB)
              </p>
            </div>
          </div>
          <section aria-label="表示名" className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          <h3 className="text-sm font-medium">表示名</h3>
          {isEditingName ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="displayName">表示名</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') handleCancelEdit();
                  }}
                  placeholder="表示名を入力"
                  autoFocus
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSaveName} disabled={isSaving || !displayName.trim()}>
                  {isSaving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  保存
                </Button>
                <Button variant="outline" onClick={handleCancelEdit} disabled={isSaving}>
                  <X className="mr-2 h-4 w-4" />
                  キャンセル
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 break-words text-base">{user.displayName}</span>
              <Button variant="outline" onClick={() => setIsEditingName(true)}>
                変更
              </Button>
            </div>
          )}
          </section>
          <section aria-label="メールアドレス" className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          <h3 className="text-sm font-medium">メールアドレス</h3>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-all text-base">{user.email}</span>
            <span className="text-sm text-muted-foreground">
              {firebaseUser?.providerData?.[0]?.providerId === 'google.com' && (
                'Googleアカウントで管理'
              )}
            </span>
          </div>
          </section>
        </CardContent>
      </Card>

      {/* Account Info */}
      <Card density="compact">
        <CardHeader>
          <CardTitle>アカウント情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">アカウント作成日</span>
            <span>
              {user.createdAt?.toLocaleDateString('ja-JP', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">認証方法</span>
            <span>
              {firebaseUser?.providerData?.[0]?.providerId === 'google.com'
                ? 'Google認証'
                : 'メール/パスワード'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Image Cropper Dialog */}
      {selectedImageSrc && (
        <ImageCropperDialog
          open={cropperOpen}
          onOpenChange={setCropperOpen}
          imageSrc={selectedImageSrc}
          onCropComplete={handleCropComplete}
          shape="round"
          aspect={1}
          title="プロフィール画像を調整"
          description="画像をドラッグして位置を調整し、スライダーで拡大縮小できます"
          outputSize={256}
        />
      )}
    </SettingsLayout>
  );
}
