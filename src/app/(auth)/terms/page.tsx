import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = {
  title: 'Terms of Service | Axon',
};

const lastUpdated = 'March 15, 2026';

export default function TermsPage() {
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
              <CardTitle className="text-heading-20">Terms of Service</CardTitle>
              <CardDescription className="text-copy-14 text-muted-foreground">
                These Terms of Service ("Terms") govern your access to and use of Axon and its related services (the
                "Service").
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <section className="space-y-2">
                <h2 className="text-label-16">1. Acceptance of the Terms</h2>
                <p className="text-copy-14 text-muted-foreground">
                  By accessing or using the Service, you agree to these Terms and our{' '}
                  <Link href="/privacy" className="text-foreground hover:underline">
                    Privacy Policy
                  </Link>
                  . If you do not agree, do not use the Service.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">2. Eligibility and Accounts</h2>
                <p className="text-copy-14 text-muted-foreground">
                  You must be able to form a binding contract to use the Service. You are responsible for maintaining
                  the confidentiality of your credentials and for all activity under your account.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">3. Acceptable Use</h2>
                <ul className="list-disc space-y-2 pl-5 text-copy-14 text-muted-foreground">
                  <li>Do not misuse the Service or attempt to gain unauthorized access.</li>
                  <li>Do not interfere with or disrupt the Service, security, or performance.</li>
                  <li>Do not use the Service in violation of applicable laws or regulations.</li>
                  <li>Do not reverse engineer, copy, or resell the Service except as permitted by law.</li>
                </ul>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">4. Your Content and License</h2>
                <p className="text-copy-14 text-muted-foreground">
                  You retain ownership of the code, data, and materials you submit or connect to the Service. You grant
                  Axon a limited license to host, process, analyze, and display your content solely to provide and
                  improve the Service.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">5. Third-Party Services</h2>
                <p className="text-copy-14 text-muted-foreground">
                  The Service may integrate with third-party services such as GitHub, GitLab, or identity providers.
                  Your use of those services is governed by their terms and policies, and Axon is not responsible for
                  third-party services.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">6. Plans and Billing</h2>
                <p className="text-copy-14 text-muted-foreground">
                  If you choose a paid plan, you agree to pay all applicable fees and taxes. Fees are non-refundable
                  except as required by law or as otherwise stated at the time of purchase.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">7. Suspension and Termination</h2>
                <p className="text-copy-14 text-muted-foreground">
                  You may stop using the Service at any time. We may suspend or terminate access if you violate these
                  Terms, create risk, or use the Service in a way that could cause harm.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">8. Disclaimers</h2>
                <p className="text-copy-14 text-muted-foreground">
                  The Service is provided "as is" and "as available." To the maximum extent permitted by law, Axon
                  disclaims all warranties, express or implied, including warranties of merchantability, fitness for a
                  particular purpose, and non-infringement.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">9. Limitation of Liability</h2>
                <p className="text-copy-14 text-muted-foreground">
                  To the maximum extent permitted by law, Axon will not be liable for any indirect, incidental,
                  special, consequential, or punitive damages, or any loss of profits, data, or goodwill, arising from
                  or related to your use of the Service.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">10. Indemnification</h2>
                <p className="text-copy-14 text-muted-foreground">
                  You agree to defend, indemnify, and hold harmless Axon from and against claims, liabilities,
                  damages, losses, and expenses arising out of your use of the Service or violation of these Terms.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">11. Governing Law</h2>
                <p className="text-copy-14 text-muted-foreground">
                  These Terms are governed by the laws of the jurisdiction where Axon is established, without regard
                  to conflict of laws principles.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">12. Changes to the Terms</h2>
                <p className="text-copy-14 text-muted-foreground">
                  We may update these Terms from time to time. If we make material changes, we will update the "Last
                  updated" date and may provide additional notice as required by law.
                </p>
              </section>

              <section className="space-y-2">
                <h2 className="text-label-16">13. Contact</h2>
                <p className="text-copy-14 text-muted-foreground">
                  For questions about these Terms, contact us through the support channel listed in the app.
                </p>
              </section>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
