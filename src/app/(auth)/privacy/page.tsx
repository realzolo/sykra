import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = {
  title: 'Privacy Policy | Axon',
};

const lastUpdated = 'March 15, 2026';

export default function PrivacyPage() {
  return (
    <div className="auth-page">
      <div className="flex w-full flex-1 justify-center">
        <div className="w-full max-w-3xl px-6 py-10">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-copy-12 text-muted-foreground">
            <Link href="/login" className="text-foreground hover:underline">
              Back to login
            </Link>
            <span>Last updated: {lastUpdated}</span>
          </div>
          <Card className="w-full">
            <CardHeader className="space-y-2">
              <CardTitle className="text-heading-20">Privacy Policy</CardTitle>
              <CardDescription className="text-copy-14 text-muted-foreground">
                This Privacy Policy explains how Axon collects, uses, and shares information when you use the
                Service.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <section className="space-y-2">
                <h2 className="text-label-16">1. Information We Collect</h2>
                <ul className="list-disc space-y-2 pl-5 text-copy-14 text-muted-foreground">
                  <li>Account information such as email address and authentication details.</li>
                  <li>Repository and code data you connect or submit for analysis.</li>
                  <li>Usage data such as feature interactions, logs, and performance metrics.</li>
                  <li>Device and browser information, including IP address and identifiers.</li>
                  <li>Cookies and similar technologies to keep you signed in and remember preferences.</li>
                </ul>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">2. How We Use Information</h2>
                <ul className="list-disc space-y-2 pl-5 text-copy-14 text-muted-foreground">
                  <li>Provide, maintain, and improve the Service.</li>
                  <li>Authenticate users and secure accounts.</li>
                  <li>Run code analysis and generate reports you request.</li>
                  <li>Communicate with you about updates, security, and support.</li>
                  <li>Comply with legal obligations and enforce our Terms.</li>
                </ul>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">3. How We Share Information</h2>
                <ul className="list-disc space-y-2 pl-5 text-copy-14 text-muted-foreground">
                  <li>With service providers that host or support the Service under appropriate safeguards.</li>
                  <li>
                    With third-party AI providers you configure, when required to process code analysis requests.
                  </li>
                  <li>With third-party integrations you connect, such as GitHub or GitLab.</li>
                  <li>To comply with law or protect the rights, safety, and security of Axon and users.</li>
                </ul>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">4. Cookies and Tracking</h2>
                <p className="text-copy-14 text-muted-foreground">
                  We use cookies and similar technologies to keep you signed in, remember preferences, and understand
                  usage patterns. You can control cookies through your browser settings, but some features may not work
                  properly if cookies are disabled.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">5. Data Retention</h2>
                <p className="text-copy-14 text-muted-foreground">
                  We retain information for as long as necessary to provide the Service and for legitimate business or
                  legal purposes. You can delete your account or connected data where supported by the Service.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">6. Security</h2>
                <p className="text-copy-14 text-muted-foreground">
                  We use reasonable technical and organizational measures to protect information. No method of
                  transmission or storage is completely secure, so we cannot guarantee absolute security.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">7. International Transfers</h2>
                <p className="text-copy-14 text-muted-foreground">
                  Your information may be processed in countries other than where you live. We take steps to ensure
                  appropriate safeguards when transferring information across borders.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">8. Your Rights and Choices</h2>
                <p className="text-copy-14 text-muted-foreground">
                  Depending on your location, you may have rights to access, correct, delete, or export your personal
                  information, and to object to or restrict certain processing. Contact us through the support channel
                  listed in the app to exercise these rights.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">9. Children's Privacy</h2>
                <p className="text-copy-14 text-muted-foreground">
                  The Service is not intended for children under 13 (or the minimum age required by local law). We do
                  not knowingly collect personal information from children.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">10. Changes to This Policy</h2>
                <p className="text-copy-14 text-muted-foreground">
                  We may update this Privacy Policy from time to time. If we make material changes, we will update the
                  "Last updated" date and may provide additional notice as required by law.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">11. Contact</h2>
                <p className="text-copy-14 text-muted-foreground">
                  For questions about this Privacy Policy or our data practices, contact us through the support channel
                  listed in the app. You should also review our{' '}
                  <Link href="/terms" className="text-foreground hover:underline">
                    Terms of Service
                  </Link>
                  .
                </p>
              </section>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
