import json
import pathlib
import subprocess
import unittest

PHP = pathlib.Path(__file__).resolve().parents[1] / 'hosting' / 'calamar-verificacion.php'


class VerificationReminderTest(unittest.TestCase):
    def test_only_an_email_verification_code_can_send_to_its_account(self):
        code = r'''
            $messages = [];
            $send = function (...$args) use (&$messages) { $messages[] = $args; return true; };
            $sendAttempt = function ($requestType, $recipient) use ($send) {
                $lookup = function ($method, $url, $data) use ($requestType) {
                    if ($method !== 'POST' || $data !== ['oobCode' => 'verify_test']) return [400, []];
                    return [200, ['requestType' => $requestType, 'email' => 'test@example.org']];
                };
                try { return reminderSend(['email' => $recipient, 'code' => 'verify_test'],
                    'no-reply@calamarmenciano.com', $lookup, $send); }
                catch (InvalidArgumentException $error) { return false; }
            };
            $result = [
                $sendAttempt('VERIFY_EMAIL', 'test@example.org'),
                $sendAttempt('PASSWORD_RESET', 'test@example.org'),
                $sendAttempt('VERIFY_EMAIL', 'different@example.org'),
            ];
            echo json_encode([$result, $messages]);
        '''
        output = subprocess.check_output(['php', '-r', f'require {json.dumps(str(PHP))}; {code}'], text=True)
        results, messages = json.loads(output)
        self.assertEqual(results, [True, False, False])
        self.assertEqual(len(messages), 1)
        recipient, subject, body, headers = messages[0]
        self.assertEqual(recipient, 'test@example.org')
        self.assertIn('Calamar TV', subject)
        self.assertIn('mode=verifyEmail&oobCode=verify_test', body)
        self.assertEqual(headers['From'], 'Calamar TV <no-reply@calamarmenciano.com>')
