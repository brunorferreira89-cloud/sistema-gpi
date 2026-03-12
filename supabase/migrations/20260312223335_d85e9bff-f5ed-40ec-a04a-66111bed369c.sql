-- Allow admin and consultor to read all profiles
CREATE POLICY "Admin and consultor can read all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (get_user_role(auth.uid()) IN ('admin', 'consultor'));

-- Allow admin and consultor to update all profiles
CREATE POLICY "Admin and consultor can update all profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (get_user_role(auth.uid()) IN ('admin', 'consultor'))
WITH CHECK (get_user_role(auth.uid()) IN ('admin', 'consultor'));