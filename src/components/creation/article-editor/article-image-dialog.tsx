"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ImageSourcePicker, type ImageLibraryEntry } from "@/components/creation/image-source-picker";
import { useI18n } from "@/lib/i18n";

/** Insert-image dialog: an online library tab and a local upload tab. */
export function ArticleImageDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (image: ImageLibraryEntry) => void;
}) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onClose={onClose} title={t("aimgTitle")} maxWidth="lg">
      <div className="space-y-4">
        <ImageSourcePicker
          onPicked={(image) => {
            onPick(image);
            onClose();
          }}
        />
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("dlgCancel")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
